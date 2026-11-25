package edu.aiu.ssp;

import static edu.aiu.ssp.Fixtures.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.time.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.*;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class GatewayAdapterTest {
  @Mock IPaymentGW externalGW;
  @InjectMocks GatewayAdapter service;

  @Test
  void chargesExternalGateway() {
    when(externalGW.charge("P-9001", FEE)).thenReturn("TXN-8841");
    assertTrue(service.processOnlinePayment("P-9001", FEE));
    verify(externalGW).charge("P-9001", FEE);
  }

  @Test
  void declinedChargeCallsGateway() {
    when(externalGW.charge("P-9001", FEE)).thenReturn("   ");
    assertFalse(service.processOnlinePayment("P-9001", FEE));
    verify(externalGW).charge("P-9001", FEE);
  }

  @Test
  void refundCallsGatewayAndHandlesFailure() {
    when(externalGW.refund("P-9001")).thenReturn("RF-1", "   ");
    assertTrue(service.processOnlineRefund("P-9001"));
    assertFalse(service.processOnlineRefund("P-9001"));
    verify(externalGW, times(2)).refund("P-9001");
  }
}
