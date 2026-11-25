package edu.aiu.ssp;

import static edu.aiu.ssp.Fixtures.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.math.BigDecimal;
import java.time.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.*;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class KitchenInventoryManagerTest {
  @Mock IDiningDB db;
  @InjectMocks KitchenInventoryManager service;

  @Test
  void readsGrilledChickenStock() {
    when(db.findMeal("M-55")).thenReturn(CHICKEN);
    assertEquals(CHICKEN, service.getStockStatus("M-55"));
    verify(db).findMeal("M-55");
  }

  @Test
  void appliesMealStockTransitions() {
    when(db.findMeal("M-55")).thenReturn(CHICKEN, CHICKEN_OUT, CHICKEN_OUT);
    assertEquals("OUT_OF_STOCK", service.setStockStatus("M-55", "OUT_OF_STOCK").stockStatus());
    assertEquals("AVAILABLE", service.setStockStatus("M-55", "AVAILABLE").stockStatus());
    assertEquals("END", service.removeMeal("M-55").stockStatus());
    verify(db).updateMealStockStatus("M-55", "OUT_OF_STOCK");
    verify(db).updateMealStockStatus("M-55", "AVAILABLE");
    verify(db).updateMealStockStatus("M-55", "END");
  }

  @Test
  void restockingAvailableMealIsIdempotent() {
    when(db.findMeal("M-55")).thenReturn(CHICKEN);
    assertEquals("AVAILABLE", service.setStockStatus("M-55", "AVAILABLE").stockStatus());
    verify(db).updateMealStockStatus("M-55", "AVAILABLE");
  }

  @Test
  void rejectsInvalidMealStateChange() {
    when(db.findMeal("M-55")).thenReturn(CHICKEN_OUT);
    assertThrows(IllegalStateException.class, () -> service.setStockStatus("M-55", "OUT_OF_STOCK"));
    verify(db, never()).updateMealStockStatus(anyString(), anyString());
  }

  @Test
  void createsMealAsAvailable() {
    BigDecimal price = new BigDecimal("20.00");
    assertEquals("AVAILABLE", service.createMeal("M-99", "Salad", price, List.of()).stockStatus());
    verify(db).saveMeal(new Meal("M-99", "Salad", price, "AVAILABLE", List.of()));
  }
}
