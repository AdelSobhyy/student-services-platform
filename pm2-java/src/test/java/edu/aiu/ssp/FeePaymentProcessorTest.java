package edu.aiu.ssp;

import static edu.aiu.ssp.Fixtures.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.math.BigDecimal;
import java.time.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.*;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class FeePaymentProcessorTest {
  @Mock IAccount account;
  @Mock IPaymentDB db;
  @Mock GatewayAdapter gateway;
  @Mock ICommunication comm;
  @Mock Identifiers ids;
  @Mock Clock clock;
  @InjectMocks FeePaymentProcessor service;

  @Test
  void TC8_1_paysHousingFeeAndIssuesReceipt() {
    when(account.verifyStudent(STUDENT)).thenReturn(true);
    when(ids.next("payment")).thenReturn("P-9001");
    when(clock.instant()).thenReturn(Instant.parse("2026-09-10T00:00:00Z"));
    when(clock.getZone()).thenReturn(ZoneOffset.UTC);
    when(ids.next("receipt")).thenReturn("RC-1");
    when(ids.next("receiptNumber")).thenReturn("RCPT-2026-0001");
    when(gateway.processOnlinePayment("P-9001", FEE)).thenReturn(true);
    Payment result = service.payFees(STUDENT, "HOUSING", "B-5001", FEE);
    Payment pending = new Payment("P-9001", STUDENT, "HOUSING", "B-5001", FEE, "PENDING");
    assertEquals(pending.after("paid"), result);
    InOrder calls = inOrder(account, db, gateway, comm);
    calls.verify(account).verifyStudent(STUDENT);
    calls.verify(db).savePayment(pending);
    calls.verify(gateway).processOnlinePayment("P-9001", FEE);
    calls.verify(db).updatePaymentStatus("P-9001", "PAID");
    calls
        .verify(db)
        .saveReceipt(
            new Receipt("RC-1", "P-9001", "RCPT-2026-0001", LocalDate.parse("2026-09-10")));
    calls.verify(comm).sendNotification(STUDENT, "Payment P-9001: PAID");
  }

  @Test
  void TC8_2_declineNotifiesWithoutReceipt() {
    when(account.verifyStudent(STUDENT)).thenReturn(true);
    when(ids.next("payment")).thenReturn("P-9001");
    assertEquals("FAILED", service.payFees(STUDENT, "HOUSING", "B-5001", FEE).status());
    verify(db).updatePaymentStatus("P-9001", "FAILED");
    verify(db, never()).saveReceipt(any());
    verify(comm).sendNotification(STUDENT, "Payment P-9001: FAILED");
  }

  @Test
  void requiresStudent() {
    assertThrows(
        UnauthorizedStudentException.class,
        () -> service.payFees(STUDENT, "HOUSING", "B-5001", FEE));
    verifyNoInteractions(db, gateway, comm);
  }

  @Test
  void rejectsZeroAndNegativeAmounts() {
    for (BigDecimal amount : List.of(BigDecimal.ZERO, BigDecimal.ONE.negate())) {
      assertThrows(
          ValidationException.class, () -> service.payFees(STUDENT, "HOUSING", "B-5001", amount));
    }
    verifyNoInteractions(db, gateway);
  }

  @Test
  void issuesRefundForPaidPayment() {
    when(db.findPayment("P-9001")).thenReturn(PAYMENT_PAID);
    when(gateway.processOnlineRefund("P-9001")).thenReturn(true);
    assertEquals("REFUNDED", service.issueRefund("P-9001").status());
    InOrder calls = inOrder(db, gateway, comm);
    calls.verify(db).findPayment("P-9001");
    calls.verify(gateway).processOnlineRefund("P-9001");
    calls.verify(db).updatePaymentStatus("P-9001", "REFUNDED");
    calls.verify(comm).sendNotification(STUDENT, "Payment P-9001 refunded");
  }

  @Test
  void cannotRefundFailedPayment() {
    when(db.findPayment("P-9001")).thenReturn(PAYMENT_FAILED);
    assertThrows(InvalidStateException.class, () -> service.issueRefund("P-9001"));
    verify(gateway, never()).processOnlineRefund(anyString());
  }
}
