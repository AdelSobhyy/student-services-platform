package edu.aiu.ssp;

import java.math.BigDecimal;
import java.time.*;

public interface IPaymentGW {
  String charge(String ref, BigDecimal amount);

  String refund(String ref);
}
