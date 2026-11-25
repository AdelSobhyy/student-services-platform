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
class TransportBookingManagerTest {
  @Mock IAccount account;
  @Mock RouteManager routes;
  @Mock ITransportDB db;
  @Mock IPayment payment;
  @Mock ICommunication comm;
  @Mock Identifiers ids;
  @InjectMocks TransportBookingManager service;

  @Test
  void TC3_3_confirmsPaidBookingInDiagramOrder() {
    when(account.verifyStudent(STUDENT)).thenReturn(true);
    when(routes.getSchedule("SCH-77")).thenReturn(schedule(12));
    when(ids.next("transport")).thenReturn("TB-9001");
    when(payment.payFees(STUDENT, "TRANSPORT", "TB-9001", FARE)).thenReturn(true);
    TransportBooking result = service.bookSeat(STUDENT, "SCH-77");
    TransportBooking pending =
        new TransportBooking("TB-9001", STUDENT, "SCH-77", 29, FARE, "PENDING");
    assertEquals(pending.after("paid"), result);
    InOrder calls = inOrder(account, routes, db, payment, comm);
    calls.verify(account).verifyStudent(STUDENT);
    calls.verify(routes).getSchedule("SCH-77");
    calls.verify(db).saveBooking(pending);
    calls.verify(payment).payFees(STUDENT, "TRANSPORT", "TB-9001", FARE);
    calls.verify(db).updateBookingStatus("TB-9001", "CONFIRMED");
    calls.verify(routes).updateSeatsAvailable(schedule(12), -1);
    calls.verify(comm).sendNotification(eq(STUDENT), contains("confirmed"));
  }

  @Test
  void declinedPaymentPreservesInventory() {
    when(account.verifyStudent(STUDENT)).thenReturn(true);
    when(routes.getSchedule("SCH-77")).thenReturn(schedule(12));
    when(ids.next("transport")).thenReturn("TB-9001");
    assertEquals("FAILED", service.bookSeat(STUDENT, "SCH-77").status());
    verify(db).updateBookingStatus("TB-9001", "FAILED");
    verify(routes, never()).updateSeatsAvailable(schedule(12), -1);
    verifyNoInteractions(comm);
  }

  @Test
  void unauthorizedStudentStopsBeforeLookup() {
    assertThrows(UnauthorizedStudentException.class, () -> service.bookSeat(STUDENT, "SCH-77"));
    verifyNoInteractions(routes, db, payment, comm);
  }

  @Test
  void TC2_4_unavailableInventoryRejectsBooking() {
    when(account.verifyStudent(STUDENT)).thenReturn(true);
    when(routes.getSchedule("SCH-77")).thenReturn(schedule(0));
    assertThrows(NoSeatAvailableException.class, () -> service.bookSeat(STUDENT, "SCH-77"));
    verifyNoInteractions(db, payment, comm);
  }

  @Test
  void TC3_5_cancelReleasesSeatAndNotifies() {
    when(db.findBooking("TB-9001")).thenReturn(TRANSPORT_CONFIRMED);
    when(routes.getSchedule("SCH-77")).thenReturn(schedule(11));
    assertEquals("CANCELLED", service.cancelBooking("TB-9001").status());
    InOrder calls = inOrder(db, routes, comm);
    calls.verify(db).updateBookingStatus("TB-9001", "CANCELLED");
    calls.verify(routes).getSchedule("SCH-77");
    calls.verify(routes).updateSeatsAvailable(schedule(11), 1);
    calls.verify(comm).sendNotification(STUDENT, "Seat 29 released");
  }

  @Test
  void cancelledTripCannotBeCancelledAgain() {
    when(db.findBooking("TB-9001"))
        .thenReturn(new TransportBooking("TB-9001", STUDENT, "SCH-77", 29, FARE, "CANCELLED"));
    assertThrows(IllegalStateException.class, () -> service.cancelBooking("TB-9001"));
    verify(db, never()).updateBookingStatus(anyString(), anyString());
    verifyNoInteractions(routes, comm);
  }

  @Test
  void completeFinishesTrip() {
    when(db.findBooking("TB-9001")).thenReturn(TRANSPORT_CONFIRMED);
    assertEquals("COMPLETED", service.complete("TB-9001").status());
    verify(db).updateBookingStatus("TB-9001", "COMPLETED");
    verify(comm).sendNotification(STUDENT, "Trip TB-9001 completed");
  }
}
