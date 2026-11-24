package edu.aiu.ssp;

import java.time.*;

public interface IGatewayAdapter {
  boolean sendExternalMsg(String email, String subject, String body);
}
