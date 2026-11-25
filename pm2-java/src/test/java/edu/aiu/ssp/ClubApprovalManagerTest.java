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
class ClubApprovalManagerTest {
  @Mock IAccount account;
  @Mock IClubDB db;
  @Mock ICommunication comm;
  @InjectMocks ClubApprovalManager service;

  @Test
  void TC4_9_adminApprovesPhotographyClub() {
    when(account.verifyRole("admin", "ADMIN")).thenReturn(true);
    when(db.findClub("C-15"))
        .thenReturn(new Club("C-15", "Photography Club", "Arts", "S-215", "PENDING"));
    service.approveClub("admin", "C-15");
    InOrder calls = inOrder(account, db, comm);
    calls.verify(account).verifyRole("admin", "ADMIN");
    calls.verify(db).findClub("C-15");
    calls.verify(db).updateClubStatus("C-15", "APPROVED");
    calls.verify(comm).sendNotification("S-215", "Photography Club approved");
  }

  @Test
  void nonAdminCannotApprove() {
    assertThrows(UnauthorizedException.class, () -> service.approveClub(STUDENT, "C-15"));
    verifyNoInteractions(db, comm);
  }

  @Test
  void rejectsApprovedOrRejectedClub() {
    when(account.verifyRole("admin", "ADMIN")).thenReturn(true);
    for (String state : List.of("APPROVED", "REJECTED")) {
      when(db.findClub("C-15"))
          .thenReturn(new Club("C-15", "Photography Club", "Arts", "S-215", state));
      assertThrows(InvalidStateException.class, () -> service.approveClub("admin", "C-15"));
    }
    verify(db, never()).updateClubStatus(any(), any());
    verifyNoInteractions(comm);
  }

  @Test
  void adminRejectsPendingClub() {
    when(account.verifyRole(ADMIN, "ADMIN")).thenReturn(true);
    when(db.findClub("C-15")).thenReturn(PENDING_CLUB);
    service.rejectClub(ADMIN, "C-15");
    InOrder calls = inOrder(account, db, comm);
    calls.verify(account).verifyRole(ADMIN, "ADMIN");
    calls.verify(db).updateClubStatus("C-15", "REJECTED");
    calls.verify(comm).sendNotification("S-215", "Photography Club rejected");
  }

  @Test
  void TC4_10_adminSuspendsApprovedClubAndReinstatesSuspendedClub() {
    when(account.verifyRole(ADMIN, "ADMIN")).thenReturn(true);
    when(db.findClub("C-12")).thenReturn(ROBOTICS, ROBOTICS_SUSPENDED);
    service.suspendClub(ADMIN, "C-12");
    service.approveClub(ADMIN, "C-12");
    verify(db).updateClubStatus("C-12", "SUSPENDED");
    verify(db).updateClubStatus("C-12", "APPROVED");
    verify(comm).sendNotification("S-210", "Robotics Club suspended");
    verify(comm).sendNotification("S-210", "Robotics Club approved");
  }

  @Test
  void cannotSuspendPendingOrRejectApprovedClub() {
    when(account.verifyRole(ADMIN, "ADMIN")).thenReturn(true);
    when(db.findClub("C-15")).thenReturn(PENDING_CLUB);
    assertThrows(InvalidStateException.class, () -> service.suspendClub(ADMIN, "C-15"));
    when(db.findClub("C-12")).thenReturn(ROBOTICS);
    assertThrows(InvalidStateException.class, () -> service.rejectClub(ADMIN, "C-12"));
    verify(db, never()).updateClubStatus(anyString(), anyString());
    verifyNoInteractions(comm);
  }
}
