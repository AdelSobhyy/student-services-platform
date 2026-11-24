package edu.aiu.ssp;

import java.math.BigDecimal;
import java.time.*;

public record Payment(
    String id,
    String studentId,
    String payableType,
    String payableId,
    BigDecimal amount,
    String status) {
  Payment after(String event) {
    return new Payment(
        id, studentId, payableType, payableId, amount, Lifecycle.Payment.next(status, event));
  }
}
