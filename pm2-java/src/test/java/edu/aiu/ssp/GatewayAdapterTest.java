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
  void declinedCharge() {
    assertFalse(service.processOnlinePayment("P-9001", FEE));
  }
}
