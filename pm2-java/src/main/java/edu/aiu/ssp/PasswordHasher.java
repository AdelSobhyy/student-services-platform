package edu.aiu.ssp;

import java.time.*;

public interface PasswordHasher {
  String hash(String password);
}
