package edu.aiu.ssp;

import java.time.*;

public interface IAccountDB {
  User findUserByEmail(String email);

  User findUserById(String id);

  void saveUser(User user);

  void updateUserStatus(String id, String status);

  Role findRoleByName(String name);

  void saveUserRole(String userId, String roleId);
}
