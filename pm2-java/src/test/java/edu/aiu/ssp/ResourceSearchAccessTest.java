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
  void reservesCleanCodeAndReturnsRemainingCopy() {
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
  void digitalDownload() {
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
}
