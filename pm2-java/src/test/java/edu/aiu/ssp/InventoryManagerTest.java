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

  @Test
  void createsAndTransitionsRoomsThroughDiagram() {
    Room created = service.createRoom("R-205", "B-205", 2, 2, FEE);
    assertEquals("AVAILABLE", created.status());
    verify(db).saveRoom(created);

    when(db.findRoom("R-204")).thenReturn(ROOM, ROOM_BOOKED, ROOM_MAINTENANCE);
    assertEquals("MAINTENANCE", service.markForMaintenance("R-204").status());
    assertEquals("AVAILABLE", service.releaseRoom("R-204").status());
    assertEquals("AVAILABLE", service.restoreRoom("R-204").status());
    verify(db).updateRoomStatus("R-204", "MAINTENANCE");
    verify(db, times(2)).updateRoomStatus("R-204", "AVAILABLE");
  }

  @Test
  void removedRoomReachesEnd() {
    when(db.findRoom("R-204")).thenReturn(ROOM);
    assertEquals("END", service.removeRoom("R-204").status());
    verify(db).updateRoomStatus("R-204", "END");
  }

  @Test
  void invalidRoomTransitionIsRejected() {
    when(db.findRoom("R-204")).thenReturn(ROOM_BOOKED);
    assertThrows(IllegalStateException.class, () -> service.markForMaintenance("R-204"));
    verify(db, never()).updateRoomStatus(anyString(), anyString());
  }
}
