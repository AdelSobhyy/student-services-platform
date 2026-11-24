package edu.aiu.ssp;

import java.time.*;

public record AuthenticationManager(
    IAccountDB db, ICommunication comm, Identifiers ids, PasswordHasher hasher) {
  public User register(UserData data) {
    if (data == null
        || data.name() == null
        || data.name().isBlank()
        || data.email() == null
        || !data.email().matches("[^@\\s]+@[^@\\s]+[.][^@\\s]+")
        || data.password() == null
        || data.password().length() < 8) throw new ValidationException();
    if (db.findUserByEmail(data.email()) != null) throw new DuplicateEmailException();
    User user =
        new User(
            ids.next("user"),
            data.name(),
            data.email(),
            hasher.hash(data.password()),
            Lifecycle.User.next("INITIAL", "register"));
    db.saveUser(user);
    Role role = db.findRoleByName("STUDENT");
    db.saveUserRole(user.id(), role.id());
    comm.sendNotification(user.id(), "Welcome " + user.name());
    return user;
  }
}
