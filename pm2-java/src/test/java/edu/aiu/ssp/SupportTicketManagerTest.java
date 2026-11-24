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
class SupportTicketManagerTest {
  @Mock IAccount account;
  @Mock ICommunicationDB db;
  @Mock NotificationManager notifier;
  @Mock Identifiers ids;
  @InjectMocks SupportTicketManager service;

  @Test
  void opensTicketAndRequestsNotification() {
    when(account.verifyStudent(STUDENT)).thenReturn(true);
    when(ids.next("ticket")).thenReturn("T-401");
    SupportTicket result = service.submitTicket(STUDENT, SUBJECT, DESCRIPTION);
    assertEquals(new SupportTicket("T-401", STUDENT, SUBJECT, DESCRIPTION, "OPEN"), result);
    InOrder calls = inOrder(account, db, notifier);
    calls.verify(account).verifyStudent(STUDENT);
    calls.verify(db).saveTicket(result);
    calls.verify(notifier).sendNotification(STUDENT, "TICKET_CREATED", "Ticket T-401 received");
  }

  @Test
  void requiresStudent() {
    assertThrows(
        UnauthorizedStudentException.class,
        () -> service.submitTicket(STUDENT, SUBJECT, DESCRIPTION));
    verifyNoInteractions(db, notifier);
  }

  @Test
  void requiresSubjectAndDescription() {
    assertThrows(ValidationException.class, () -> service.submitTicket(STUDENT, "", DESCRIPTION));
    assertThrows(ValidationException.class, () -> service.submitTicket(STUDENT, SUBJECT, " "));
    verifyNoInteractions(db, notifier);
  }
}
