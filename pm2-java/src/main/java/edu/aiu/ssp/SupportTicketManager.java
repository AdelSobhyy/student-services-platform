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

  /** OPEN -> IN_PROGRESS (first or subsequent reply); RESOLVED tickets reject replies. */
  public SupportTicket respondToTicket(String ticketId, String response, boolean resolve) {
    SupportTicket current = requireTicket(ticketId);
    SupportTicket result = withStatus(current, resolve ? "resolve" : "reply");
    db.saveTicketResponse(ticketId, response);
    db.updateTicketStatus(ticketId, result.status());
    return result;
  }

  /** RESOLVED -> OPEN when the student reopens a ticket. */
  public SupportTicket reopenTicket(String ticketId) {
    return withPersistedStatus(ticketId, "reopen");
  }

  /** RESOLVED -> END when a ticket is closed. */
  public SupportTicket closeTicket(String ticketId) {
    return withPersistedStatus(ticketId, "close");
  }

  private SupportTicket withPersistedStatus(String ticketId, String event) {
    SupportTicket result = withStatus(requireTicket(ticketId), event);
    db.updateTicketStatus(ticketId, result.status());
    return result;
  }

  private SupportTicket requireTicket(String ticketId) {
    SupportTicket ticket = db.findTicket(ticketId);
    if (ticket == null) throw new TicketNotFoundException(ticketId);
    return ticket;
  }

  private SupportTicket withStatus(SupportTicket ticket, String event) {
    return new SupportTicket(
        ticket.id(),
        ticket.studentId(),
        ticket.subject(),
        ticket.description(),
        Lifecycle.SupportTicket.next(ticket.status(), event));
  }
}
