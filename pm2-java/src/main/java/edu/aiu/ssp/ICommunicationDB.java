package edu.aiu.ssp;

import java.time.*;

public interface ICommunicationDB {
  void saveTicket(SupportTicket ticket);

  SupportTicket findTicket(String id);

  void updateTicketStatus(String id, String status);

  void saveTicketResponse(String ticketId, String response);

  void saveNotification(Notification notification);

  Notification findNotification(String id);

  void updateNotificationStatus(String id, String status);
}
