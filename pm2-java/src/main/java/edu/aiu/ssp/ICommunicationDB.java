package edu.aiu.ssp;

import java.time.*;

public interface ICommunicationDB {
  void saveTicket(SupportTicket ticket);

  void saveNotification(Notification notification);

  void updateNotificationStatus(String id, String status);
}
