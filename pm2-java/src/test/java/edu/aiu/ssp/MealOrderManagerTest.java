package edu.aiu.ssp;

import static edu.aiu.ssp.Fixtures.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.time.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.*;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class MealOrderManagerTest {
  @Mock IAccount account;
  @Mock KitchenInventoryManager inventory;
  @Mock DietaryPreferenceManager dietary;
  @Mock IDiningDB db;
  @Mock IPayment payment;
  @Mock ICommunication comm;
  @Mock Identifiers ids;
  @InjectMocks MealOrderManager service;

  @Test
  void ordersGrilledChickenAndPays() {
    when(account.verifyStudent(STUDENT)).thenReturn(true);
    when(inventory.getStockStatus("M-55")).thenReturn(CHICKEN);
    when(ids.next("order")).thenReturn("O-7001");
    when(payment.payFees(STUDENT, "MEAL", "O-7001", CHICKEN.price())).thenReturn(true);
    MealOrder order = service.orderMeal(STUDENT, "M-55");
    MealOrder created =
        new MealOrder("O-7001", STUDENT, "M-55", CHICKEN.price(), List.of(), "CREATED");
    assertEquals(created.after("paid"), order);
    InOrder calls = inOrder(account, inventory, dietary, db, payment, comm);
    calls.verify(account).verifyStudent(STUDENT);
    calls.verify(inventory).getStockStatus("M-55");
    calls.verify(dietary).highlightConflicts(STUDENT, "M-55");
    calls.verify(db).saveOrder(created);
    calls.verify(payment).payFees(STUDENT, "MEAL", "O-7001", CHICKEN.price());
    calls.verify(db).updateOrderStatus("O-7001", "PAID");
    calls.verify(comm).sendNotification(STUDENT, "Order O-7001 paid");
  }

  @Test
  void declinedMealPayment() {
    when(account.verifyStudent(STUDENT)).thenReturn(true);
    when(inventory.getStockStatus("M-55")).thenReturn(CHICKEN);
    when(ids.next("order")).thenReturn("O-7001");
    assertEquals("PAYMENT_FAILED", service.orderMeal(STUDENT, "M-55").status());
    verify(db).updateOrderStatus("O-7001", "PAYMENT_FAILED");
    verifyNoInteractions(comm);
  }

  @Test
  void unavailableMealStopsOrder() {
    when(account.verifyStudent(STUDENT)).thenReturn(true);
    when(inventory.getStockStatus("M-55"))
        .thenReturn(new Meal("M-55", CHICKEN.name(), CHICKEN.price(), "OUT_OF_STOCK", List.of()));
    assertThrows(MealUnavailableException.class, () -> service.orderMeal(STUDENT, "M-55"));
    verifyNoInteractions(db, payment, dietary, comm);
  }

  @Test
  void paidOrderHighlightsConflicts() {
    when(account.verifyStudent(STUDENT)).thenReturn(true);
    when(inventory.getStockStatus("M-71")).thenReturn(NOODLES);
    when(ids.next("order")).thenReturn("O-7001");
    when(dietary.highlightConflicts(STUDENT, "M-71")).thenReturn(List.of(ALLERGY));
    when(payment.payFees(STUDENT, "MEAL", "O-7001", NOODLES.price())).thenReturn(true);
    MealOrder order = service.orderMeal(STUDENT, "M-71");
    assertEquals(List.of(ALLERGY), order.conflicts());
    assertEquals("PAID", order.status());
  }

  @Test
  void requiresStudent() {
    assertThrows(UnauthorizedStudentException.class, () -> service.orderMeal(STUDENT, "M-55"));
    verifyNoInteractions(inventory, db, payment);
  }

  @Test
  void cancelsPaidOrderBeforeDeadline() {
    when(db.findOrder("O-7001")).thenReturn(ORDER_PAID);
    assertEquals("CANCELLED", service.cancelOrder("O-7001", true).status());
    verify(db).updateOrderStatus("O-7001", "CANCELLED");
    verify(comm).sendNotification(STUDENT, "Order O-7001 cancelled");
  }

  @Test
  void rejectsLateCancellationBeforeAnyPersistence() {
    assertThrows(CancellationDeadlinePassed.class, () -> service.cancelOrder("O-7001", false));
    verifyNoInteractions(db, comm);
  }

  @Test
  void cannotCancelCompletedOrder() {
    when(db.findOrder("O-7001"))
        .thenReturn(
            new MealOrder(
                "O-7001", STUDENT, "M-55", CHICKEN.price(), List.of(), "COMPLETED"));
    assertThrows(IllegalStateException.class, () -> service.cancelOrder("O-7001", true));
    verify(db, never()).updateOrderStatus(anyString(), anyString());
  }

  @Test
  void servesPaidOrder() {
    when(db.findOrder("O-7001")).thenReturn(ORDER_PAID);
    assertEquals("COMPLETED", service.serveOrder("O-7001").status());
    verify(db).updateOrderStatus("O-7001", "COMPLETED");
    verify(comm).sendNotification(STUDENT, "Order O-7001 served");
  }
}
