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

  /** Admin-driven SUSPENDED / DEACTIVATED / ACTIVE transitions from the state diagram. */
  public User manageAccountStatus(String userId, String targetStatus) {
    if (targetStatus == null || targetStatus.isBlank()) throw new ValidationException();
    User user = db.findUserById(userId);
    if (user == null) throw new ValidationException();
    String event =
        switch (targetStatus) {
          case "SUSPENDED" -> "suspend";
          case "ACTIVE" -> "activate";
          case "DEACTIVATED" -> "deactivate";
          case "END" -> "close";
          default -> throw new ValidationException();
        };
    String next = Lifecycle.User.next(user.status(), event);
    db.updateUserStatus(user.id(), next);
    comm.sendNotification(user.id(), "Account status: " + next);
    return new User(user.id(), user.name(), user.email(), user.passwordHash(), next);
  }

  /** Login guard asserted by FR1.2 and the User state diagram. */
  public void assertLoginAllowed(User user) {
    if (user == null) throw new ValidationException();
    if ("ACTIVE".equals(user.status())) return;
    if ("SUSPENDED".equals(user.status())) throw new AccountSuspendedException();
    if ("DEACTIVATED".equals(user.status())) throw new AccountDeactivatedException();
    throw new InvalidStateException();
  }
}
