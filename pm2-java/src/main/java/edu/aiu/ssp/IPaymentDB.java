package edu.aiu.ssp;

import java.time.*;

public interface IPaymentDB {
  void savePayment(Payment payment);

  void updatePaymentStatus(String id, String status);

  void saveReceipt(Receipt receipt);
}
