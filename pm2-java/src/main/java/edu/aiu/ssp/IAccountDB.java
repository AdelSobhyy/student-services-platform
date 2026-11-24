package edu.aiu.ssp;

import java.time.*;

public interface IAccountDB {
  User findUserByEmail(String email);

  void saveUser(User user);

  Role findRoleByName(String name);

  void saveUserRole(String userId, String roleId);
}
