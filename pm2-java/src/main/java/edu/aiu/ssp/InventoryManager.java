package edu.aiu.ssp;

import java.math.BigDecimal;
import java.time.*;

public record InventoryManager(IAccommodationDB db) {
  public Room isAvailable(String id, Dates dates) {
    Room room = db.findRoom(id);
    return room != null
            && room.spaces() > 0
            && "AVAILABLE".equals(room.status())
            && !db.overlaps(id, dates)
        ? room
        : null;
  }

  /** Kept for the booking collaboration: persist a room status decided by the caller. */
  public void updateAvailability(String id, String status) {
    db.updateRoomStatus(id, status);
  }

  /** INITIAL -> AVAILABLE (manageRooms in the Room state diagram). */
  public Room createRoom(String id, String number, int capacity, int spaces, BigDecimal price) {
    Room room =
        new Room(id, number, capacity, spaces, price, Lifecycle.Room.next("INITIAL", "create"));
    db.saveRoom(room);
    return room;
  }

  /** Applies any Room diagram event to the persisted room and returns the new state. */
  public Room transition(String id, String event) {
    Room room = db.findRoom(id);
    if (room == null) throw new ValidationException();
    Room result =
        new Room(
            room.id(),
            room.number(),
            room.capacity(),
            room.spaces(),
            room.price(),
            Lifecycle.Room.next(room.status(), event));
    db.updateRoomStatus(id, result.status());
    return result;
  }

  public Room releaseRoom(String id) {
    return transition(id, "release");
  }

  public Room markForMaintenance(String id) {
    return transition(id, "maintain");
  }

  public Room restoreRoom(String id) {
    return transition(id, "restore");
  }

  public Room removeRoom(String id) {
    return transition(id, "remove");
  }
}
