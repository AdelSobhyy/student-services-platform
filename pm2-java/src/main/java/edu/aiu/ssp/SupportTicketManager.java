package edu.aiu.ssp;

import java.time.*;

public record SupportTicketManager(
    IAccount account, ICommunicationDB db, NotificationManager notifier, Identifiers ids) {
  public SupportTicket submitTicket(String studentId, String subject, String description) {
    if (subject == null || subject.isBlank() || description == null || description.isBlank())
      throw new ValidationException();
    if (!account.verifyStudent(studentId)) throw new UnauthorizedStudentException();
    SupportTicket ticket =
        new SupportTicket(
            ids.next("ticket"),
            studentId,
            subject,
            description,
            Lifecycle.SupportTicket.next("INITIAL", "submit"));
    db.saveTicket(ticket);
    notifier.sendNotification(studentId, "TICKET_CREATED", "Ticket " + ticket.id() + " received");
    return ticket;
  }
}
