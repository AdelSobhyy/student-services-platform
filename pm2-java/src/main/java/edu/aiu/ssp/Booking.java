package edu.aiu.ssp;

import java.math.BigDecimal;
import java.time.*;

public record Booking(
    String id, String studentId, String roomId, Dates dates, BigDecimal amount, String status) {
  Booking after(String event) {
    return new Booking(id, studentId, roomId, dates, amount, Lifecycle.Booking.next(status, event));
  }
}
