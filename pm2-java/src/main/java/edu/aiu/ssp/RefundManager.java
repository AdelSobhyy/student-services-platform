package edu.aiu.ssp;

/** Implements the Refund state machine from the PM2 collaboration diagram. */
public record RefundManager(
    IAccount account,
    IPaymentDB db,
    IPaymentGW gateway,
    ICommunication comm,
    Identifiers ids) {

  public Refund requestRefund(String studentId, String paymentId) {
    if (!account.verifyStudent(studentId)) throw new UnauthorizedStudentException();
    Payment payment = db.findPayment(paymentId);
    if (payment == null || !"PAID".equals(payment.status())) throw new InvalidStateException();
    Refund refund =
        new Refund(
            ids.next("refund"),
            payment.id(),
            studentId,
            payment.amount(),
            Lifecycle.Refund.next("INITIAL", "request"));
    db.saveRefund(refund);
    comm.sendNotification(studentId, "Refund " + refund.id() + " requested");
    return refund;
  }

  public Refund reviewRefund(String adminId, String refundId, boolean approve) {
    if (!account.verifyRole(adminId, "ADMIN")) throw new UnauthorizedException();
    Refund current = requireRefund(refundId);
    Refund result = current.after(approve ? "approve" : "reject");
    db.updateRefundStatus(result.id(), result.status());
    comm.sendNotification(result.studentId(), "Refund " + result.id() + " " + result.status());
    return result;
  }

  public Refund issueRefund(String adminId, String refundId) {
    if (!account.verifyRole(adminId, "ADMIN")) throw new UnauthorizedException();
    Refund current = requireRefund(refundId);
    String event = gateway.refund(current.id()) != null ? "issued" : "failed";
    Refund result = current.after(event);
    db.updateRefundStatus(result.id(), result.status());
    comm.sendNotification(result.studentId(), "Refund " + result.id() + " " + result.status());
    return result;
  }

  private Refund requireRefund(String refundId) {
    Refund refund = db.findRefund(refundId);
    if (refund == null) throw new ValidationException();
    return refund;
  }
}
