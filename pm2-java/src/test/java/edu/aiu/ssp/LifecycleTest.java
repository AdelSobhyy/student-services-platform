package edu.aiu.ssp;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvFileSource;

class LifecycleTest {
  @ParameterizedTest(name = "{0} {1} + {2} => {3}")
  @CsvFileSource(resources = "/transitions.csv")
  void diagramTransition(
      Lifecycle machine, String from, String event, String expected, String diagramRow) {
    if ("REJECT".equals(expected)) {
      assertThrows(IllegalStateException.class, () -> machine.next(from, event), diagramRow);
    } else {
      assertEquals(expected, machine.next(from, event), diagramRow);
    }
  }
}
