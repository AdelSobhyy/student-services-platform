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
class ResourceSearchAccessTest {
  @Mock IAccount account;
  @Mock CatalogManager catalog;
  @Mock ILibraryDB db;
  @Mock Identifiers ids;
  @InjectMocks ResourceSearchAccess service;

  @Test
  void TC7_2_reservesCleanCodeAndReturnsRemainingCopy() {
    when(account.verifyStudent(STUDENT)).thenReturn(true);
    when(catalog.getResource("L-300")).thenReturn(book(2));
    when(ids.next("reservation")).thenReturn("RS-12");
    assertEquals(book(1), service.accessResource("L-300", STUDENT));
    InOrder calls = inOrder(account, catalog, db);
    calls.verify(account).verifyStudent(STUDENT);
    calls.verify(catalog).getResource("L-300");
    calls.verify(db).saveReservation(new Reservation("RS-12", STUDENT, "L-300", "RESERVED"));
    calls.verify(db).updateCopies("L-300", -1);
  }

  @Test
  void noCopies() {
    when(account.verifyStudent(STUDENT)).thenReturn(true);
    when(catalog.getResource("L-300")).thenReturn(book(0));
    assertThrows(CopiesNotAvailableException.class, () -> service.accessResource("L-300", STUDENT));
    verifyNoInteractions(db);
  }

  @Test
  void missingOrInactiveResource() {
    when(account.verifyStudent(STUDENT)).thenReturn(true);
    when(catalog.getResource("L-300"))
        .thenReturn(null, new Resource("L-300", "PRINTED_BOOK", "Clean Code", 1, false));
    for (int attempt = 0; attempt < 2; attempt++) {
      assertThrows(ResourceNotFoundException.class, () -> service.accessResource("L-300", STUDENT));
    }
    verifyNoInteractions(db);
  }

  @Test
  void TC7_3_digitalDownload() {
    when(account.verifyStudent(STUDENT)).thenReturn(true);
    Resource digital = new Resource("L-301", "DIGITAL", "Clean Code", 0, true);
    when(catalog.getResource("L-301")).thenReturn(digital);
    assertEquals(digital, service.accessResource("L-301", STUDENT));
    verify(db).logDownload("L-301", STUDENT);
    verifyNoMoreInteractions(db);
  }

  @Test
  void requiresStudent() {
    assertThrows(
        UnauthorizedStudentException.class, () -> service.accessResource("L-300", STUDENT));
    verifyNoInteractions(catalog, db);
  }

  @Test
  void collectsCancelsExpiresAndReturnsReservations() {
    when(db.findReservation("RS-12"))
        .thenReturn(
            RESERVATION_RESERVED,
            RESERVATION_RESERVED,
            RESERVATION_RESERVED,
            RESERVATION_COLLECTED);
    assertEquals("COLLECTED", service.collectReservation("RS-12").status());
    assertEquals("CANCELLED", service.cancelReservation("RS-12").status());
    assertEquals("EXPIRED", service.expireReservation("RS-12").status());
    assertEquals("RETURNED", service.returnBook("RS-12").status());
    verify(db).updateReservationStatus("RS-12", "COLLECTED");
    verify(db).updateReservationStatus("RS-12", "CANCELLED");
    verify(db).updateReservationStatus("RS-12", "EXPIRED");
    verify(db).updateReservationStatus("RS-12", "RETURNED");
    verify(db, times(2)).updateCopies("L-300", 1);
  }

  @Test
  void expiredReservationCannotBeCollected() {
    when(db.findReservation("RS-12"))
        .thenReturn(new Reservation("RS-12", STUDENT, "L-300", "EXPIRED"));
    assertThrows(IllegalStateException.class, () -> service.collectReservation("RS-12"));
    verify(db, never()).updateReservationStatus(anyString(), anyString());
  }
}
