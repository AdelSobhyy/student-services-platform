package edu.aiu.ssp;

import static edu.aiu.ssp.Fixtures.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.*;
import org.mockito.junit.jupiter.MockitoExtension;

/** Covers the Refund state machine and its gateway/notification collaborations. */
@ExtendWith(MockitoExtension.class)
class RefundManagerTest {
  @Mock IAccount account;
  @Mock IPaymentDB db;
  @Mock IPaymentGW gateway;
  @Mock ICommunication comm;
  @Mock Identifiers ids;
  @InjectMocks RefundManager service;

  @Test
  void TC8_3_studentRequestsRefund() {
    when(account.verifyStudent(STUDENT)).thenReturn(true);
    when(db.findPayment("P-9001")).thenReturn(PAYMENT_PAID);
    when(ids.next("refund")).thenReturn("RF-1");
    assertEquals(REFUND_REQUESTED, service.requestRefund(STUDENT, "P-9001"));
    InOrder calls = inOrder(account, db, comm);
    calls.verify(account).verifyStudent(STUDENT);
    calls.verify(db).findPayment("P-9001");
    calls.verify(db).saveRefund(REFUND_REQUESTED);
    calls.verify(comm).sendNotification(STUDENT, "Refund RF-1 requested");
  }

  @Test
  void adminReviewsRefund() {
    when(account.verifyRole(ADMIN, "ADMIN")).thenReturn(true);
    when(db.findRefund("RF-1")).thenReturn(REFUND_REQUESTED);
    assertEquals("APPROVED", service.reviewRefund(ADMIN, "RF-1", true).status());
    assertEquals("REJECTED", service.reviewRefund(ADMIN, "RF-1", false).status());
    verify(db).updateRefundStatus("RF-1", "APPROVED");
    verify(db).updateRefundStatus("RF-1", "REJECTED");
  }

  @Test
  void TC8_4_approvedRefundIsIssuedThroughGateway() {
    when(account.verifyRole(ADMIN, "ADMIN")).thenReturn(true);
    when(db.findRefund("RF-1")).thenReturn(REFUND_APPROVED);
    when(gateway.refund("RF-1")).thenReturn("GW-77");
    assertEquals("ISSUED", service.issueRefund(ADMIN, "RF-1").status());
    verify(gateway).refund("RF-1");
    verify(db).updateRefundStatus("RF-1", "ISSUED");
    verify(comm).sendNotification(STUDENT, "Refund RF-1 ISSUED");
  }

  @Test
  void gatewayFailureMarksRefundFailed() {
    when(account.verifyRole(ADMIN, "ADMIN")).thenReturn(true);
    when(db.findRefund("RF-1")).thenReturn(REFUND_APPROVED);
    assertEquals("FAILED", service.issueRefund(ADMIN, "RF-1").status());
    verify(db).updateRefundStatus("RF-1", "FAILED");
  }

  @Test
  void alreadyIssuedRefundCannotBeApproved() {
    when(account.verifyRole(ADMIN, "ADMIN")).thenReturn(true);
    when(db.findRefund("RF-1"))
        .thenReturn(new Refund("RF-1", "P-9001", STUDENT, FEE, "ISSUED"));
    assertThrows(IllegalStateException.class, () -> service.reviewRefund(ADMIN, "RF-1", true));
    verify(db, never()).updateRefundStatus(anyString(), anyString());
  }

  @Test
  void nonAdminCannotReview() {
    assertThrows(UnauthorizedException.class, () -> service.reviewRefund(STUDENT, "RF-1", true));
    verifyNoInteractions(db, gateway, comm);
  }

  @Test
  void cannotRefundUnpaidPayment() {
    when(account.verifyStudent(STUDENT)).thenReturn(true);
    when(db.findPayment("P-9001")).thenReturn(PAYMENT_FAILED);
    assertThrows(InvalidStateException.class, () -> service.requestRefund(STUDENT, "P-9001"));
    verify(db, never()).saveRefund(any());
  }
}
