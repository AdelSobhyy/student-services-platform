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
class NotificationManagerTest {
  @Mock ICommunicationDB db;
  @Mock IAccount account;
  @Mock IGatewayAdapter gateway;
  @Mock Identifiers ids;
  @InjectMocks NotificationManager service;

  @Test
  void deliversTicketEmail() {
    String title = "Ticket T-401 received";
    when(ids.next("notification")).thenReturn("N-88");
    when(account.getUserEmail(STUDENT)).thenReturn("s103@student.edu");
    when(gateway.sendExternalMsg("s103@student.edu", title, title)).thenReturn(true);
    Notification result = service.sendNotification(STUDENT, "TICKET_CREATED", title);
    Notification pending =
        new Notification("N-88", STUDENT, "TICKET_CREATED", title, "EMAIL", "PENDING");
    assertEquals(pending.after("delivered"), result);
    InOrder calls = inOrder(db, account, gateway);
    calls.verify(db).saveNotification(pending);
    calls.verify(account).getUserEmail(STUDENT);
    calls.verify(gateway).sendExternalMsg("s103@student.edu", title, title);
    calls.verify(db).updateNotificationStatus("N-88", "SENT");
  }

  @Test
  void failedDeliveryPreservesOpenTicket() {
    when(account.verifyStudent(STUDENT)).thenReturn(true);
    when(ids.next("ticket")).thenReturn("T-401");
    when(ids.next("notification")).thenReturn("N-88");
    when(account.getUserEmail(STUDENT)).thenReturn("s103@student.edu");
    SupportTicketManager tickets = new SupportTicketManager(account, db, service, ids);
    SupportTicket ticket = tickets.submitTicket(STUDENT, SUBJECT, DESCRIPTION);
    assertEquals("OPEN", ticket.status());
    InOrder calls = inOrder(db);
    calls.verify(db).saveTicket(ticket);
    calls.verify(db).updateNotificationStatus("N-88", "FAILED");
  }
}
