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
  void TC6_3_opensTicketAndRequestsNotification() {
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

  @Test
  void TC6_4_repliesAndResolvesTicketThroughDiagram() {
    when(db.findTicket("T-401")).thenReturn(TICKET_OPEN, TICKET_IN_PROGRESS);
    assertEquals(
        "IN_PROGRESS", service.respondToTicket("T-401", "We are checking", false).status());
    assertEquals("RESOLVED", service.respondToTicket("T-401", "Fixed", true).status());
    InOrder calls = inOrder(db);
    calls.verify(db).saveTicketResponse("T-401", "We are checking");
    calls.verify(db).updateTicketStatus("T-401", "IN_PROGRESS");
    calls.verify(db).saveTicketResponse("T-401", "Fixed");
    calls.verify(db).updateTicketStatus("T-401", "RESOLVED");
  }

  @Test
  void reopensAndClosesResolvedTicket() {
    when(db.findTicket("T-401")).thenReturn(TICKET_RESOLVED);
    assertEquals("OPEN", service.reopenTicket("T-401").status());
    assertEquals("END", service.closeTicket("T-401").status());
    verify(db).updateTicketStatus("T-401", "OPEN");
    verify(db).updateTicketStatus("T-401", "END");
  }

  @Test
  void resolvedTicketRejectsReplies() {
    when(db.findTicket("T-401")).thenReturn(TICKET_RESOLVED);
    assertThrows(
        IllegalStateException.class, () -> service.respondToTicket("T-401", "again", false));
    verify(db, never()).saveTicketResponse(anyString(), anyString());
  }

  @Test
  void unknownTicketIsReported() {
    assertThrows(
        TicketNotFoundException.class,
        () -> service.respondToTicket("MISSING", "Hello", false));
    verify(db, never()).saveTicketResponse(anyString(), anyString());
  }
}
