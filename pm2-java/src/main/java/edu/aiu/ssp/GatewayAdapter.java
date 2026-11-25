package edu.aiu.ssp;

import java.math.BigDecimal;
import java.time.*;

public record GatewayAdapter(IPaymentGW externalGW) {
  public boolean processOnlinePayment(String id, BigDecimal amount) {
    String ref = externalGW.charge(id, amount);
    return ref != null && !ref.isBlank();
  }

  /** Refund side of the gateway collaboration; a blank reference means the refund failed. */
  public boolean processOnlineRefund(String paymentRef) {
    String ref = externalGW.refund(paymentRef);
    return ref != null && !ref.isBlank();
  }
}
