package edu.aiu.ssp;

import java.time.*;

public interface IPaymentDB {
  void savePayment(Payment payment);

  Payment findPayment(String id);

  void updatePaymentStatus(String id, String status);

  void saveReceipt(Receipt receipt);

  void saveRefund(Refund refund);

  Refund findRefund(String id);

  void updateRefundStatus(String id, String status);
}
