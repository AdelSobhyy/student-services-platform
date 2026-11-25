package edu.aiu.ssp;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvFileSource;

/** Every valid and invalid transition from the state diagram is executed from transitions.csv. */
class LifecycleTest {
  @ParameterizedTest(name = "{0} {1} + {2} => {3}")
  @CsvFileSource(resources = "/transitions.csv")
  void diagramTransition(
      Lifecycle machine, String from, String event, String expected, String diagramRow) {
    if ("REJECT".equals(expected)) {
      assertThrows(expectedRejection(diagramRow), () -> machine.next(from, event), diagramRow);
    } else {
      assertEquals(expected, machine.next(from, event), diagramRow);
    }
  }

  private static Class<? extends Throwable> expectedRejection(String diagramRow) {
    if (diagramRow.contains("AccountSuspendedException")) return AccountSuspendedException.class;
    if (diagramRow.contains("AccountDeactivatedException")) return AccountDeactivatedException.class;
    if (diagramRow.contains("RoomNotAvailableException")) return RoomNotAvailableException.class;
    if (diagramRow.contains("ClubNotAvailableException")) return ClubNotAvailableException.class;
    if (diagramRow.contains("CancellationDeadlinePassed")) return CancellationDeadlinePassed.class;
    if (diagramRow.contains("MealUnavailableException")) return MealUnavailableException.class;
    if (diagramRow.contains("TicketNotFoundException")) return TicketNotFoundException.class;
    return IllegalStateException.class;
  }
}
