package edu.aiu.ssp;

import java.math.BigDecimal;
import java.time.*;

public interface IPayment {
  boolean payFees(String studentId, String type, String id, BigDecimal amount);
}
