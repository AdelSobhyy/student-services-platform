package edu.aiu.ssp;

import java.math.BigDecimal;
import java.time.*;

public record TransportBooking(
    String id,
    String studentId,
    String scheduleId,
    int seatNumber,
    BigDecimal amount,
    String status) {
  TransportBooking after(String event) {
    return new TransportBooking(
        id,
        studentId,
        scheduleId,
        seatNumber,
        amount,
        Lifecycle.TransportBooking.next(status, event));
  }
}
