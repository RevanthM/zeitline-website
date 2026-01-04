import express, { Request, Response, Router } from "express";

const router: Router = express.Router();

// OpenAI API configuration
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

/**
 * POST /nutrition/scan-label
 * Scan a nutrition label image using OpenAI Vision API
 */
router.post("/scan-label", async (req: Request, res: Response) => {
  try {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({
        success: false,
        error: "Missing image data",
      });
    }

    // Get OpenAI API key from environment
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("OPENAI_API_KEY not configured");
      return res.status(500).json({
        success: false,
        error: "OpenAI API key not configured",
      });
    }

    // Prepare the prompt for nutrition extraction
    const prompt = `Analyze this nutrition label image and extract the nutritional information.
Return ONLY a valid JSON object with the following structure (use null for missing values):

{
    "food_name": "Product name if visible",
    "serving_size": "Serving size as shown on label",
    "calories": number,
    "protein": number (in grams),
    "carbs": number (in grams),
    "fat": number (in grams),
    "fiber": number or null (in grams),
    "sugar": number or null (in grams),
    "sodium": number or null (in milligrams),
    "saturated_fat": number or null (in grams),
    "cholesterol": number or null (in milligrams)
}

Only return the JSON, no other text.`;

    // Call OpenAI Vision API
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: prompt,
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${image}`,
                },
              },
            ],
          },
        ],
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API error:", errorText);
      return res.status(500).json({
        success: false,
        error: "Failed to analyze image",
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return res.status(500).json({
        success: false,
        error: "No response from AI",
      });
    }

    // Parse the JSON from the response
    // Remove markdown code blocks if present
    const jsonString = content
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    let nutritionData;
    try {
      nutritionData = JSON.parse(jsonString);
    } catch (parseError) {
      console.error("Failed to parse nutrition JSON:", content);
      return res.status(500).json({
        success: false,
        error: "Failed to parse nutrition data",
      });
    }

    // Format the response
    const result = {
      success: true,
      foodName: nutritionData.food_name || null,
      servingSize: nutritionData.serving_size || null,
      nutrition: {
        calories: nutritionData.calories || 0,
        protein: nutritionData.protein || 0,
        carbs: nutritionData.carbs || 0,
        fat: nutritionData.fat || 0,
        fiber: nutritionData.fiber || null,
        sugar: nutritionData.sugar || null,
        sodium: nutritionData.sodium || null,
        saturatedFat: nutritionData.saturated_fat || null,
        cholesterol: nutritionData.cholesterol || null,
      },
    };

    console.log("✅ Nutrition scan successful:", result.foodName);
    return res.json(result);
  } catch (error) {
    console.error("Nutrition scan error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * POST /nutrition/analyze-food
 * Analyze a food image to identify and estimate nutrition
 */
router.post("/analyze-food", async (req: Request, res: Response) => {
  try {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({
        success: false,
        error: "Missing image data",
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "OpenAI API key not configured",
      });
    }

    const prompt = `Analyze this food image and identify the food items. For each item, estimate the nutritional content.
Return a JSON array with the following structure:

[
  {
    "name": "Food item name",
    "portion_estimate": "Estimated portion size",
    "calories": number,
    "protein": number (in grams),
    "carbs": number (in grams),
    "fat": number (in grams)
  }
]

Be reasonable with estimates. Only return the JSON array, no other text.`;

    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${image}` },
              },
            ],
          },
        ],
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      return res.status(500).json({
        success: false,
        error: "Failed to analyze image",
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return res.status(500).json({
        success: false,
        error: "No response from AI",
      });
    }

    const jsonString = content
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    let foods;
    try {
      foods = JSON.parse(jsonString);
    } catch {
      return res.status(500).json({
        success: false,
        error: "Failed to parse food data",
      });
    }

    return res.json({
      success: true,
      foods: foods,
    });
  } catch (error) {
    console.error("Food analysis error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * GET /nutrition/exercise-database
 * Get the exercise database with MET values
 */
router.get("/exercise-database", async (_req: Request, res: Response) => {
  const exercises = [
    // Cardio
    { id: "running_moderate", name: "Running (Moderate)", category: "cardio", met: 9.8 },
    { id: "running_fast", name: "Running (Fast)", category: "cardio", met: 11.5 },
    { id: "walking_brisk", name: "Walking (Brisk)", category: "cardio", met: 4.3 },
    { id: "cycling_moderate", name: "Cycling (Moderate)", category: "cardio", met: 6.8 },
    { id: "swimming_moderate", name: "Swimming (Moderate)", category: "cardio", met: 5.8 },
    { id: "elliptical", name: "Elliptical Trainer", category: "cardio", met: 5.0 },
    { id: "jump_rope", name: "Jump Rope", category: "cardio", met: 11.0 },
    { id: "hiit", name: "HIIT Training", category: "cardio", met: 8.0 },
    { id: "hiking", name: "Hiking", category: "cardio", met: 5.3 },
    
    // Strength
    { id: "weight_training", name: "Weight Training", category: "strength", met: 5.0 },
    { id: "squats", name: "Squats", category: "strength", met: 5.5 },
    { id: "deadlift", name: "Deadlift", category: "strength", met: 6.0 },
    { id: "pushups", name: "Push-ups", category: "strength", met: 3.8 },
    { id: "pullups", name: "Pull-ups", category: "strength", met: 4.8 },
    { id: "planks", name: "Planks", category: "strength", met: 3.0 },
    
    // Flexibility
    { id: "yoga_hatha", name: "Yoga (Hatha)", category: "flexibility", met: 2.5 },
    { id: "yoga_power", name: "Yoga (Power)", category: "flexibility", met: 4.0 },
    { id: "pilates", name: "Pilates", category: "flexibility", met: 3.0 },
    { id: "stretching", name: "Stretching", category: "flexibility", met: 2.3 },
    
    // Sports
    { id: "basketball", name: "Basketball", category: "sports", met: 6.5 },
    { id: "soccer", name: "Soccer", category: "sports", met: 7.0 },
    { id: "tennis", name: "Tennis", category: "sports", met: 7.3 },
    { id: "golf", name: "Golf (Walking)", category: "sports", met: 4.3 },
    { id: "boxing", name: "Boxing", category: "sports", met: 7.8 },
  ];

  return res.json({
    success: true,
    exercises: exercises,
  });
});

export default router;

