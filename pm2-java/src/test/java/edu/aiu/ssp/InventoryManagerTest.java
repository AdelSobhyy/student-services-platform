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
class InventoryManagerTest {
  @Mock IAccommodationDB db;
  @InjectMocks InventoryManager service;

  @Test
  void readsAvailableRoomAndPersistsBookedStatus() {
    when(db.findRoom("R-204")).thenReturn(ROOM);
    assertEquals(ROOM, service.isAvailable("R-204", DATES));
    service.updateAvailability("R-204", "BOOKED");
    InOrder calls = inOrder(db);
    calls.verify(db).findRoom("R-204");
    calls.verify(db).overlaps("R-204", DATES);
    calls.verify(db).updateRoomStatus("R-204", "BOOKED");
  }

  @Test
  void overlappingReservationBlocksDates() {
    when(db.findRoom("R-204")).thenReturn(ROOM);
    when(db.overlaps("R-204", DATES)).thenReturn(true);
    assertNull(service.isAvailable("R-204", DATES));
  }

  @Test
  void checkoutMustFollowCheckin() {
    assertThrows(ValidationException.class, () -> new Dates(DATES.checkIn(), DATES.checkIn()));
  }
}
