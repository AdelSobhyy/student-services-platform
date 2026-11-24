package edu.aiu.ssp;

import java.time.*;

public record Notification(
    String id, String recipientId, String type, String title, String channel, String status) {
  Notification after(String event) {
    return new Notification(
        id, recipientId, type, title, channel, Lifecycle.Notification.next(status, event));
  }
}
