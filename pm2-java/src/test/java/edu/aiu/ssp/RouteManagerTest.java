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
class RouteManagerTest {
  @Mock ITransportDB db;
  @InjectMocks RouteManager service;

  @Test
  void TC3_3_persistsElevenRemainingSeats() {
    when(db.findSchedule("SCH-77")).thenReturn(schedule(12));
    RouteSchedule before = service.getSchedule("SCH-77");
    service.updateSeatsAvailable(before, -1);
    InOrder calls = inOrder(db);
    calls.verify(db).findSchedule("SCH-77");
    calls.verify(db).saveSeatsAvailable("SCH-77", 11);
  }

  @Test
  void TC3_4_preventsNegativeCapacity() {
    assertThrows(
        NoSeatAvailableException.class, () -> service.updateSeatsAvailable(schedule(0), -1));
    verifyNoInteractions(db);
  }
}
