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
class MembershipManagerTest {
  @Mock IAccount account;
  @Mock ClubBrowser browser;
  @Mock IClubDB db;
  @Mock Identifiers ids;
  @InjectMocks MembershipManager service;

  @Test
  void TC4_3_joinsApprovedRoboticsClub() {
    when(account.verifyStudent(STUDENT)).thenReturn(true);
    when(browser.getClub("C-12")).thenReturn(ROBOTICS);
    when(ids.next("membership")).thenReturn("M-301");
    assertTrue(service.joinClub(STUDENT, "C-12"));
    InOrder calls = inOrder(account, browser, db);
    calls.verify(account).verifyStudent(STUDENT);
    calls.verify(browser).getClub("C-12");
    calls.verify(db).findMembership(STUDENT, "C-12");
    ArgumentCaptor<Membership> saved = ArgumentCaptor.forClass(Membership.class);
    calls.verify(db).saveMembership(saved.capture());
    assertEquals(new Membership("M-301", STUDENT, "C-12", "ACTIVE"), saved.getValue());
  }

  @Test
  void TC4_4_activeMemberCannotJoinTwice() {
    when(account.verifyStudent(STUDENT)).thenReturn(true);
    when(browser.getClub("C-12")).thenReturn(ROBOTICS);
    when(db.findMembership(STUDENT, "C-12"))
        .thenReturn(new Membership("M-301", STUDENT, "C-12", "ACTIVE"));
    assertFalse(service.joinClub(STUDENT, "C-12"));
    verify(db, never()).saveMembership(any());
  }

  @Test
  void TC4_5_pendingAndSuspendedClubsRejectMembership() {
    when(account.verifyStudent(STUDENT)).thenReturn(true);
    for (String state : List.of("PENDING", "SUSPENDED")) {
      when(browser.getClub("C-12"))
          .thenReturn(new Club("C-12", "Robotics Club", "Technology", "S-210", state));
      assertThrows(ClubNotAvailableException.class, () -> service.joinClub(STUDENT, "C-12"));
    }
    verifyNoInteractions(db);
  }

  @Test
  void requiresStudent() {
    assertThrows(UnauthorizedStudentException.class, () -> service.joinClub(STUDENT, "C-12"));
    verifyNoInteractions(browser, db);
  }

  @Test
  void TC4_6_leavesAndRejoinsClub() {
    when(account.verifyStudent(STUDENT)).thenReturn(true);
    when(db.findMembership(STUDENT, "C-12")).thenReturn(MEMBERSHIP_ACTIVE);
    assertTrue(service.leaveClub(STUDENT, "C-12"));
    verify(db).saveMembership(MEMBERSHIP_LEFT);

    when(db.findMembership(STUDENT, "C-12")).thenReturn(MEMBERSHIP_LEFT);
    when(browser.getClub("C-12")).thenReturn(ROBOTICS);
    assertTrue(service.joinClub(STUDENT, "C-12"));
    verify(db).saveMembership(MEMBERSHIP_ACTIVE);
  }

  @Test
  void removesLeftMembership() {
    when(db.findMembership(STUDENT, "C-12")).thenReturn(MEMBERSHIP_LEFT);
    assertTrue(service.removeMembership(STUDENT, "C-12"));
    verify(db).saveMembership(new Membership("M-301", STUDENT, "C-12", "END"));
  }

  @Test
  void cannotLeaveAClubAlreadyLeft() {
    when(db.findMembership(STUDENT, "C-12")).thenReturn(MEMBERSHIP_LEFT);
    assertThrows(IllegalStateException.class, () -> service.leaveClub(STUDENT, "C-12"));
    verify(db, never()).saveMembership(any());
  }
}
