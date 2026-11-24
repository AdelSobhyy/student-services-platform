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
}
