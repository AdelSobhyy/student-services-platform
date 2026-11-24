package edu.aiu.ssp;

import java.math.BigDecimal;
import java.time.*;

public record FeePaymentProcessor(
    IAccount account,
    IPaymentDB db,
    GatewayAdapter gateway,
    ICommunication comm,
    Identifiers ids,
    Clock clock) {
  public Payment payFees(String studentId, String type, String payableId, BigDecimal amount) {
    if (amount == null || amount.signum() <= 0) throw new ValidationException();
    if (!account.verifyStudent(studentId)) throw new UnauthorizedStudentException();
    Payment payment =
        new Payment(
            ids.next("payment"),
            studentId,
            type,
            payableId,
            amount,
            Lifecycle.Payment.next("INITIAL", "save"));
    db.savePayment(payment);
    boolean paid = gateway.processOnlinePayment(payment.id(), amount);
    Payment result = payment.after(paid ? "paid" : "declined");
    db.updatePaymentStatus(result.id(), result.status());
    if (paid)
      db.saveReceipt(
          new Receipt(
              ids.next("receipt"), result.id(), ids.next("receiptNumber"), LocalDate.now(clock)));
    comm.sendNotification(studentId, "Payment " + result.id() + ": " + result.status());
    return result;
  }
}
