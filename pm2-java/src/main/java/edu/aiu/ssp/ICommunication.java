package edu.aiu.ssp;

import java.time.*;

public interface ICommunication {
  void sendNotification(String userId, String message);
}
