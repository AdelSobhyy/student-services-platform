package edu.aiu.ssp;

import static edu.aiu.ssp.Fixtures.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.time.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.*;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ClubBrowserTest {
  @Mock IClubDB db;
  @InjectMocks ClubBrowser service;

  @Test
  void TC4_1_readsRoboticsClub() {
    when(db.findClub("C-12")).thenReturn(ROBOTICS);
    assertEquals(ROBOTICS, service.getClub("C-12"));
    verify(db).findClub("C-12");
  }
}
