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
class CatalogManagerTest {
  @Mock ILibraryDB db;
  @InjectMocks CatalogManager service;

  @Test
  void readsCleanCodeFromCatalog() {
    when(db.findResourceById("L-300")).thenReturn(book(2));
    assertEquals(book(2), service.getResource("L-300"));
    verify(db).findResourceById("L-300");
  }
}
