package edu.aiu.ssp;

import java.math.BigDecimal;

/** Refund aggregate from the PM2 object model; status follows Lifecycle.Refund. */
public record Refund(
    String id, String paymentId, String studentId, BigDecimal amount, String status) {
  Refund after(String event) {
    return new Refund(id, paymentId, studentId, amount, Lifecycle.Refund.next(status, event));
  }
}
