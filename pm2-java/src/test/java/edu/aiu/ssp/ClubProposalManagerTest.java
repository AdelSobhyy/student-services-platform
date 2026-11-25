package edu.aiu.ssp;

import static edu.aiu.ssp.Fixtures.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.*;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ClubProposalManagerTest {
  @Mock IClubDB db;
  @Mock Identifiers ids;
  @InjectMocks ClubProposalManager service;

  @Test
  void proposalEntersPending() {
    when(ids.next("club")).thenReturn("C-15");
    assertEquals(PENDING_CLUB, service.propose("S-215", "Photography Club", "Arts"));
    verify(db).saveClub(PENDING_CLUB);
  }
}
