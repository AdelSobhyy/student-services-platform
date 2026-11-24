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
class DietaryPreferenceManagerTest {
  @Mock IDiningDB db;
  @InjectMocks DietaryPreferenceManager service;

  @Test
  void peanutIngredientConflictsWithSavedAllergy() {
    when(db.findMeal("M-71")).thenReturn(NOODLES);
    when(db.findDietaryPreferences(STUDENT)).thenReturn(List.of(ALLERGY));
    assertEquals(List.of(ALLERGY), service.highlightConflicts(STUDENT, "M-71"));
    InOrder calls = inOrder(db);
    calls.verify(db).findMeal("M-71");
    calls.verify(db).findDietaryPreferences(STUDENT);
  }

  @Test
  void noSavedRestrictions() {
    when(db.findMeal("M-71")).thenReturn(NOODLES);
    assertTrue(service.highlightConflicts(STUDENT, "M-71").isEmpty());
  }

  @Test
  void noMatchingIngredient() {
    when(db.findMeal("M-71")).thenReturn(NOODLES);
    when(db.findDietaryPreferences(STUDENT))
        .thenReturn(List.of(new DietaryRestriction("DR-3", "Milk", "ALLERGY", "I-10")));
    assertTrue(service.highlightConflicts(STUDENT, "M-71").isEmpty());
  }

  @Test
  void missingMeal() {
    assertThrows(MealNotFoundException.class, () -> service.highlightConflicts(STUDENT, "M-71"));
    verify(db, never()).findDietaryPreferences(any());
  }
}
