package edu.aiu.ssp;

import java.time.*;

public interface IAccount {
  boolean verifyStudent(String studentId);

  boolean verifyRole(String userId, String role);

  String getUserEmail(String id);
}
