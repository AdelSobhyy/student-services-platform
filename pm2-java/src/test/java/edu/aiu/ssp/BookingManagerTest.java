package edu.aiu.ssp;

import static edu.aiu.ssp.Fixtures.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.time.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.*;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class BookingManagerTest {
  @Mock IAccount account;
  @Mock InventoryManager inventory;
  @Mock IAccommodationDB db;
  @Mock IPayment payment;
  @Mock ICommunication comm;
  @Mock Identifiers ids;
  @InjectMocks BookingManager service;

  @Test
  void confirmsPaidBookingInDiagramOrder() {
    when(account.verifyStudent(STUDENT)).thenReturn(true);
    when(inventory.isAvailable("R-204", DATES)).thenReturn(ROOM);
    when(ids.next("booking")).thenReturn("B-5001");
    when(payment.payFees(STUDENT, "HOUSING", "B-5001", FEE)).thenReturn(true);
    Booking result = service.bookRoom(STUDENT, "R-204", DATES);
    Booking pending = new Booking("B-5001", STUDENT, "R-204", DATES, FEE, "PENDING");
    assertEquals(pending.after("paid"), result);
    InOrder calls = inOrder(account, inventory, db, payment, comm);
    calls.verify(account).verifyStudent(STUDENT);
    calls.verify(inventory).isAvailable("R-204", DATES);
    calls.verify(db).saveBooking(pending);
    calls.verify(payment).payFees(STUDENT, "HOUSING", "B-5001", FEE);
    calls.verify(db).updateBookingStatus("B-5001", "CONFIRMED");
    calls.verify(inventory).updateAvailability("R-204", "BOOKED");
    calls.verify(comm).sendNotification(eq(STUDENT), contains("confirmed"));
  }

  @Test
  void declinedPaymentPreservesInventory() {
    when(account.verifyStudent(STUDENT)).thenReturn(true);
    when(inventory.isAvailable("R-204", DATES)).thenReturn(ROOM);
    when(ids.next("booking")).thenReturn("B-5001");
    assertEquals("FAILED", service.bookRoom(STUDENT, "R-204", DATES).status());
    verify(db).updateBookingStatus("B-5001", "FAILED");
    verify(inventory, never()).updateAvailability("R-204", "BOOKED");
    verifyNoInteractions(comm);
  }

  @Test
  void unauthorizedStudentStopsBeforeLookup() {
    assertThrows(
        UnauthorizedStudentException.class, () -> service.bookRoom(STUDENT, "R-204", DATES));
    verifyNoInteractions(inventory, db, payment, comm);
  }

  @Test
  void unavailableInventoryRejectsBooking() {
    when(account.verifyStudent(STUDENT)).thenReturn(true);
    assertThrows(RoomNotAvailableException.class, () -> service.bookRoom(STUDENT, "R-204", DATES));
    verifyNoInteractions(db, payment, comm);
  }

  @Test
  void cancelsConfirmedAndPendingBookings() {
    when(db.findBooking("B-1")).thenReturn(BOOKING_CONFIRMED);
    when(db.findBooking("B-2"))
        .thenReturn(new Booking("B-2", STUDENT, "R-204", DATES, FEE, "PENDING"));
    assertEquals("CANCELLED", service.cancelBooking("B-1").status());
    assertEquals("CANCELLED", service.cancelBooking("B-2").status());
    InOrder calls = inOrder(db, inventory, comm);
    calls.verify(db).updateBookingStatus("B-5001", "CANCELLED");
    calls.verify(inventory).updateAvailability("R-204", "AVAILABLE");
    calls.verify(comm).sendNotification(STUDENT, "Booking B-5001 cancelled");
    calls.verify(db).updateBookingStatus("B-2", "CANCELLED");
    verify(inventory, times(2)).updateAvailability("R-204", "AVAILABLE");
  }

  @Test
  void rejectsCancellingAnAlreadyCancelledBooking() {
    when(db.findBooking("B-1"))
        .thenReturn(new Booking("B-1", STUDENT, "R-204", DATES, FEE, "CANCELLED"));
    assertThrows(IllegalStateException.class, () -> service.cancelBooking("B-1"));
    verify(db, never()).updateBookingStatus(anyString(), anyString());
    verifyNoInteractions(inventory, comm);
  }

  @Test
  void checkoutCompletesConfirmedBooking() {
    when(db.findBooking("B-5001")).thenReturn(BOOKING_CONFIRMED);
    assertEquals("COMPLETED", service.checkout("B-5001").status());
    verify(db).updateBookingStatus("B-5001", "COMPLETED");
    verify(comm).sendNotification(STUDENT, "Booking B-5001 completed");
  }
}
