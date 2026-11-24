package edu.aiu.ssp;

import java.time.*;

public record NotificationManager(
    ICommunicationDB db, IAccount account, IGatewayAdapter gateway, Identifiers ids) {
  public Notification sendNotification(String studentId, String type, String message) {
    Notification notification =
        new Notification(
            ids.next("notification"),
            studentId,
            type,
            message,
            "EMAIL",
            Lifecycle.Notification.next("INITIAL", "send"));
    db.saveNotification(notification);
    String email = account.getUserEmail(studentId);
    boolean sent = gateway.sendExternalMsg(email, message, message);
    Notification result = notification.after(sent ? "delivered" : "failed");
    db.updateNotificationStatus(result.id(), result.status());
    return result;
  }
}
