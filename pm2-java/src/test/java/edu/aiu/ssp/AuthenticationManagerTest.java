package edu.aiu.ssp;

import static edu.aiu.ssp.Fixtures.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.time.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.*;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class AuthenticationManagerTest {
  @Mock IAccountDB db;
  @Mock ICommunication comm;
  @Mock Identifiers ids;
  @Mock PasswordHasher hasher;
  @InjectMocks AuthenticationManager service;

  @Test
  void registersStudentAndSendsWelcome() {
    when(ids.next("user")).thenReturn("U-1001");
    when(hasher.hash(DATA.password())).thenReturn("fixture-password-hash");
    when(db.findRoleByName("STUDENT")).thenReturn(new Role("R-01", "STUDENT"));
    User result = service.register(DATA);
    assertEquals(
        new User("U-1001", DATA.name(), DATA.email(), "fixture-password-hash", "ACTIVE"), result);
    InOrder calls = inOrder(db, comm);
    calls.verify(db).findUserByEmail(DATA.email());
    calls.verify(db).saveUser(result);
    calls.verify(db).findRoleByName("STUDENT");
    calls.verify(db).saveUserRole("U-1001", "R-01");
    calls.verify(comm).sendNotification("U-1001", "Welcome Emad Mohamed");
  }

  @Test
  void duplicateEmailStopsRegistration() {
    when(db.findUserByEmail(DATA.email())).thenReturn(mock(User.class));
    assertThrows(DuplicateEmailException.class, () -> service.register(DATA));
    verify(db, never()).saveUser(any());
    verifyNoInteractions(comm);
  }

  @Test
  void invalidFieldsStopBeforeLookup() {
    for (UserData invalid :
        List.of(
            new UserData("", DATA.email(), DATA.password()),
            new UserData(DATA.name(), "bad-email", DATA.password()),
            new UserData(DATA.name(), DATA.email(), "123"))) {
      assertThrows(ValidationException.class, () -> service.register(invalid));
    }
    verifyNoInteractions(db, comm);
  }

  @Test
  void managesEveryUserStatusTransition() {
    checkStatusChange("U-1", "ACTIVE", "SUSPENDED");
    checkStatusChange("U-2", "SUSPENDED", "ACTIVE");
    checkStatusChange("U-3", "ACTIVE", "DEACTIVATED");
    checkStatusChange("U-4", "SUSPENDED", "DEACTIVATED");
    checkStatusChange("U-5", "DEACTIVATED", "ACTIVE");
    checkStatusChange("U-6", "DEACTIVATED", "END");
    verify(db, times(6)).updateUserStatus(anyString(), anyString());
    verify(comm, times(6)).sendNotification(anyString(), anyString());
  }

  private void checkStatusChange(String id, String from, String target) {
    when(db.findUserById(id)).thenReturn(new User(id, "User", "u@student.edu", "hash", from));
    assertEquals(target, service.manageAccountStatus(id, target).status());
    verify(db).updateUserStatus(id, target);
  }

  @Test
  void rejectsInvalidUserStatusChanges() {
    when(db.findUserById("U-1")).thenReturn(USER_ACTIVE);
    assertThrows(IllegalStateException.class, () -> service.manageAccountStatus("U-1", "ACTIVE"));
    when(db.findUserById("U-2")).thenReturn(USER_DEACTIVATED);
    assertThrows(
        IllegalStateException.class, () -> service.manageAccountStatus("U-2", "SUSPENDED"));
    verify(db, never()).updateUserStatus(anyString(), anyString());
    verifyNoInteractions(comm);
  }

  @Test
  void loginGuardDistinguishesSuspendedAndDeactivated() {
    assertDoesNotThrow(() -> service.assertLoginAllowed(USER_ACTIVE));
    assertThrows(AccountSuspendedException.class, () -> service.assertLoginAllowed(USER_SUSPENDED));
    assertThrows(
        AccountDeactivatedException.class, () -> service.assertLoginAllowed(USER_DEACTIVATED));
    assertThrows(ValidationException.class, () -> service.assertLoginAllowed(null));
    verifyNoInteractions(db, comm);
  }
}
