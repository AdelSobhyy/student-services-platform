package edu.aiu.ssp;

import java.math.BigDecimal;
import java.time.*;

public record GatewayAdapter(IPaymentGW externalGW) {
  public boolean processOnlinePayment(String id, BigDecimal amount) {
    String ref = externalGW.charge(id, amount);
    return ref != null && !ref.isBlank();
  }
}
